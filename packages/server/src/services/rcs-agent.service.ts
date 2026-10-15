// ===========================================
// RCS agent lifecycle (one agent per organization)
// ===========================================
//
// draft -> submitted -> ready_for_testing -> in_testing -> pending_launch -> live
// The customer fills the profile here; SimplyRCS reviews it and Google/Infobip provision it.

import type { Prisma, RcsAgent, RcsAgentStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { simplyRcsService } from './simplyrcs.service.js';
import { providerOperationService } from './provider-operation.service.js';
import { mapAgentStatus, isApprovedTestDevice } from './rcs-agent-status.js';

export interface RcsAgentInput {
  senderName: string;
  displayName: string;
  description: string;
  logoUrl: string;
  bannerUrl: string;
  color: string;
  billingCategory?: 'NON_CONVERSATIONAL' | 'CONVERSATIONAL';
  useCase?: 'OTP' | 'TRANSACTIONAL' | 'PROMOTIONAL' | 'MULTI_USE';
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  privacyUrl?: string | null;
  termsUrl?: string | null;
}

export { mapAgentStatus, isApprovedTestDevice };

const EDITABLE: RcsAgentStatus[] = ['draft', 'rejected'];

export class RcsAgentService {
  async getForOrganization(organizationId: string): Promise<RcsAgent | null> {
    return prisma.rcsAgent.findUnique({ where: { organizationId } });
  }

  /**
   * The agent that may send to this recipient right now, or null. A live agent sends to anyone;
   * an agent still in testing sends only to phones that accepted a test-device invite, which is
   * how RCS is verified before launch.
   */
  async getLiveAgent(organizationId: string, recipient?: string): Promise<{ id: string; senderIdId: string; testing?: boolean } | null> {
    const agent = await prisma.rcsAgent.findUnique({ where: { organizationId } });
    if (!agent || !agent.simplyrcsSenderIdId) return null;
    if (agent.status === 'live') return { id: agent.id, senderIdId: agent.simplyrcsSenderIdId };
    if (recipient && ['ready_for_testing', 'in_testing', 'pending_launch'].includes(agent.status) && isApprovedTestDevice(agent.testDevices, recipient)) {
      return { id: agent.id, senderIdId: agent.simplyrcsSenderIdId, testing: true };
    }
    return null;
  }

  /**
   * Uses an agent that already exists on the SimplyRCS account instead of registering a new one
   * (the dev account has several). Pulls the profile and test devices from the provider.
   */
  async linkExisting(organizationId: string, senderName: string): Promise<RcsAgent> {
    const existing = await prisma.rcsAgent.findUnique({ where: { organizationId } });
    if (existing && !EDITABLE.includes(existing.status) && existing.senderName !== senderName) {
      throw new BadRequestError(`This organization already uses agent ${existing.senderName}.`);
    }
    const channels = await simplyRcsService.listChannels();
    const channel = channels.find((item) => item.type === 'RCS' && item.status === 'ACTIVE') ?? channels.find((item) => item.type === 'RCS');
    if (!channel) throw new BadRequestError('SimplyRCS has no RCS channel on this account.');
    const remote = await simplyRcsService.getAgent(channel.id, senderName);
    const senderIds = await simplyRcsService.listSenderIds({ type: 'RCS_AGENT' });
    const senderId = senderIds.find((item) => item.identifier === senderName) ?? null;
    if (!senderId) throw new BadRequestError(`Agent ${senderName} has no sender id on SimplyRCS yet.`);
    const devices = await simplyRcsService.listTestDevices(channel.id, senderName).catch(() => []);
    const remoteStatus = remote.status ?? remote.senderStatus ?? null;
    const status = mapAgentStatus(remoteStatus, 'ready_for_testing');
    const brand = remote.brand && typeof remote.brand === 'object' ? String((remote.brand as { brandName?: string }).brandName ?? '') : String(remote.brand ?? '');
    const data = {
      senderName,
      displayName: remote.displayName ?? senderName,
      description: remote.description ?? `Linked SimplyRCS agent ${senderName}${brand ? ` (${brand})` : ''}.`,
      logoUrl: remote.logoUrl ?? '',
      bannerUrl: remote.bannerUrl ?? '',
      color: remote.color ?? '#2FB267',
      billingCategory: remote.billingCategory ?? 'CONVERSATIONAL',
      useCase: remote.useCase ?? 'MULTI_USE',
      phone: remote.phone ?? null,
      email: remote.email ?? null,
      website: remote.website ?? null,
      privacyUrl: remote.privacyUrl ?? null,
      termsUrl: remote.termsOfServiceUrl ?? null,
      status,
      simplyrcsChannelId: channel.id,
      simplyrcsSenderIdId: senderId.id,
      providerStatus: remoteStatus,
      providerMessage: null,
      testDevices: devices as unknown as Prisma.InputJsonValue,
      submittedAt: existing?.submittedAt ?? new Date(),
      launchedAt: status === 'live' ? existing?.launchedAt ?? new Date() : existing?.launchedAt ?? null,
      lastStatusSyncedAt: new Date(),
      lastSubmissionError: null,
    };
    const agent = existing
      ? await prisma.rcsAgent.update({ where: { id: existing.id }, data })
      : await prisma.rcsAgent.create({ data: { ...data, organizationId } });
    await providerOperationService.log({ organizationId, provider: 'simplyrcs', operation: 'link_rcs_agent', localResourceType: 'rcs_agent', localResourceId: agent.id, externalId: senderId.id, status: 'success', responsePayload: { senderName, status: remoteStatus, testDevices: devices.length } });
    return agent;
  }

  /** Agents on the account that could be linked, with their provider status. */
  async listAvailableAgents(): Promise<Array<{ senderName: string; displayName: string | null; status: string | null; hasSenderId: boolean }>> {
    const channels = await simplyRcsService.listChannels();
    const channel = channels.find((item) => item.type === 'RCS');
    if (!channel) return [];
    const [agents, senderIds] = await Promise.all([simplyRcsService.listAgents(channel.id), simplyRcsService.listSenderIds({ type: 'RCS_AGENT' })]);
    const withIds = new Set(senderIds.map((item) => item.identifier));
    return agents.map((agent) => ({ senderName: agent.senderName, displayName: agent.displayName ?? null, status: agent.status ?? agent.senderStatus ?? null, hasSenderId: withIds.has(agent.senderName) }));
  }

  async saveDraft(organizationId: string, input: RcsAgentInput): Promise<RcsAgent> {
    const existing = await prisma.rcsAgent.findUnique({ where: { organizationId } });
    if (existing && !EDITABLE.includes(existing.status)) {
      throw new BadRequestError(`The agent is ${existing.status.replaceAll('_', ' ')} and can no longer be edited here.`);
    }
    const senderName = input.senderName.trim().replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60);
    if (!senderName) throw new BadRequestError('Sender name is required.');
    if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) throw new BadRequestError('Brand colour must be a hex value such as #2FB267.');
    const data = {
      senderName,
      displayName: input.displayName.trim(),
      description: input.description.trim(),
      logoUrl: input.logoUrl.trim(),
      bannerUrl: input.bannerUrl.trim(),
      color: input.color.toUpperCase(),
      billingCategory: input.billingCategory ?? 'CONVERSATIONAL',
      useCase: input.useCase ?? 'MULTI_USE',
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      website: input.website?.trim() || null,
      privacyUrl: input.privacyUrl?.trim() || null,
      termsUrl: input.termsUrl?.trim() || null,
    };
    return existing
      ? prisma.rcsAgent.update({ where: { id: existing.id }, data: { ...data, status: 'draft', providerMessage: null, lastSubmissionError: null } })
      : prisma.rcsAgent.create({ data: { ...data, organizationId } });
  }

  /** Creates the agent on SimplyRCS and submits it for review. */
  async submit(organizationId: string): Promise<RcsAgent> {
    const agent = await prisma.rcsAgent.findUnique({ where: { organizationId } });
    if (!agent) throw new NotFoundError('Create the RCS agent first.');
    if (!EDITABLE.includes(agent.status)) throw new BadRequestError('The agent was already submitted.');

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const channels = await simplyRcsService.listChannels();
    const channel = channels.find((item) => item.type === 'RCS' && item.status === 'ACTIVE') ?? channels.find((item) => item.type === 'RCS');
    if (!channel) throw new BadRequestError('SimplyRCS has no RCS channel on this account yet. Ask Signalmash to enable one.');

    try {
      const created = await simplyRcsService.createAgent(channel.id, {
        senderName: agent.senderName,
        brand: organization.name,
        displayName: agent.displayName,
        description: agent.description,
        logoUrl: agent.logoUrl,
        bannerUrl: agent.bannerUrl,
        color: agent.color,
        billingCategory: agent.billingCategory as 'NON_CONVERSATIONAL' | 'CONVERSATIONAL',
        useCase: agent.useCase as 'OTP' | 'TRANSACTIONAL' | 'PROMOTIONAL' | 'MULTI_USE',
        phone: agent.phone ?? undefined,
        email: agent.email ?? undefined,
        website: agent.website ?? undefined,
        privacyUrl: agent.privacyUrl ?? undefined,
        termsOfServiceUrl: agent.termsUrl ?? undefined,
      });

      // The agent becomes a sender id of type RCS_AGENT; its id is what the send API wants.
      const senderIds = await simplyRcsService.listSenderIds({ type: 'RCS_AGENT' });
      const senderId = senderIds.find((item) => item.identifier === agent.senderName || item.identifier === created.senderName) ?? null;
      if (senderId) {
        try { await simplyRcsService.submitSenderId(senderId.id); } catch (error) { logger.warn({ error, senderId: senderId.id }, 'Sender id submit was refused; the agent review continues on the provider side'); }
      }

      const updated = await prisma.rcsAgent.update({
        where: { id: agent.id },
        data: {
          status: mapAgentStatus(created.status ?? created.senderStatus, 'submitted'),
          simplyrcsChannelId: channel.id,
          simplyrcsSenderIdId: senderId?.id ?? null,
          providerStatus: created.status ?? created.senderStatus ?? 'SUBMITTED',
          providerMessage: null,
          submittedAt: new Date(),
          lastSubmissionError: null,
          lastStatusSyncedAt: new Date(),
        },
      });
      await providerOperationService.log({ organizationId, provider: 'simplyrcs', operation: 'submit_rcs_agent', localResourceType: 'rcs_agent', localResourceId: agent.id, externalId: senderId?.id ?? created.senderName, status: 'success', responsePayload: { status: created.status, senderIdId: senderId?.id ?? null } });
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.rcsAgent.update({ where: { id: agent.id }, data: { lastSubmissionError: message } });
      await providerOperationService.log({ organizationId, provider: 'simplyrcs', operation: 'submit_rcs_agent', localResourceType: 'rcs_agent', localResourceId: agent.id, status: 'failed', errorMessage: message });
      throw error;
    }
  }

  async refreshStatus(organizationId: string): Promise<RcsAgent> {
    const agent = await prisma.rcsAgent.findUnique({ where: { organizationId } });
    if (!agent) throw new NotFoundError('No RCS agent yet.');
    if (!agent.simplyrcsChannelId) return agent;
    const remote = await simplyRcsService.getAgent(agent.simplyrcsChannelId, agent.senderName);
    const remoteStatus = remote.status ?? remote.senderStatus ?? null;
    let senderIdId = agent.simplyrcsSenderIdId;
    if (!senderIdId) {
      const senderIds = await simplyRcsService.listSenderIds({ type: 'RCS_AGENT' });
      senderIdId = senderIds.find((item) => item.identifier === agent.senderName)?.id ?? null;
    }
    const devices = await simplyRcsService.listTestDevices(agent.simplyrcsChannelId, agent.senderName).catch(() => null);
    const status = mapAgentStatus(remoteStatus, agent.status);
    return prisma.rcsAgent.update({
      where: { id: agent.id },
      data: {
        status,
        simplyrcsSenderIdId: senderIdId,
        providerStatus: remoteStatus,
        testDevices: devices ? (devices as unknown as Prisma.InputJsonValue) : undefined,
        launchedAt: status === 'live' && !agent.launchedAt ? new Date() : agent.launchedAt,
        lastStatusSyncedAt: new Date(),
      },
    });
  }

  async addTestDevice(organizationId: string, phoneNumber: string): Promise<RcsAgent> {
    const agent = await prisma.rcsAgent.findUnique({ where: { organizationId } });
    if (!agent?.simplyrcsChannelId) throw new BadRequestError('Submit the agent before adding test devices.');
    await simplyRcsService.addTestDevice(agent.simplyrcsChannelId, agent.senderName, phoneNumber);
    await providerOperationService.log({ organizationId, provider: 'simplyrcs', operation: 'add_rcs_test_device', localResourceType: 'rcs_agent', localResourceId: agent.id, status: 'success', requestPayload: { phoneNumber } });
    return this.refreshStatus(organizationId);
  }

  async launch(organizationId: string): Promise<RcsAgent> {
    const agent = await prisma.rcsAgent.findUnique({ where: { organizationId } });
    if (!agent?.simplyrcsSenderIdId) throw new BadRequestError('The agent has no sender id yet; refresh its status first.');
    if (!['in_testing', 'ready_for_testing'].includes(agent.status)) throw new BadRequestError(`The agent is ${agent.status.replaceAll('_', ' ')}; launch is only possible after testing.`);
    await simplyRcsService.launchSenderId(agent.simplyrcsSenderIdId);
    await providerOperationService.log({ organizationId, provider: 'simplyrcs', operation: 'launch_rcs_agent', localResourceType: 'rcs_agent', localResourceId: agent.id, externalId: agent.simplyrcsSenderIdId, status: 'success' });
    await prisma.rcsAgent.update({ where: { id: agent.id }, data: { status: 'pending_launch', providerStatus: 'PENDING_LAUNCH' } });
    return this.refreshStatus(organizationId);
  }

  /** Admin-only: mark the agent live or suspended locally (mirrors manual brand/campaign status). */
  async setLocalStatus(organizationId: string, status: 'live' | 'suspended' | 'rejected', reason?: string): Promise<RcsAgent> {
    const agent = await prisma.rcsAgent.findUnique({ where: { organizationId } });
    if (!agent) throw new NotFoundError('No RCS agent yet.');
    return prisma.rcsAgent.update({ where: { id: agent.id }, data: { status, providerMessage: reason ?? agent.providerMessage, launchedAt: status === 'live' ? agent.launchedAt ?? new Date() : agent.launchedAt } });
  }

  /** Finds the organization an inbound SimplyRCS event belongs to. */
  async findBySenderIdId(senderIdId: string): Promise<RcsAgent | null> {
    return prisma.rcsAgent.findUnique({ where: { simplyrcsSenderIdId: senderIdId } });
  }
}

export const rcsAgentService = new RcsAgentService();
