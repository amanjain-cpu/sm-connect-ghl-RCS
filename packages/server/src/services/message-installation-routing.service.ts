export interface InstallationSenderProfileSnapshot {
  id: string;
  phoneNumberId?: string | null;
  senderKey: string;
  phoneNumberActive?: boolean;
}

export type InstallationSenderPolicyResult =
  | {
      allowed: true;
      matchedProfileId?: string;
    }
  | {
      allowed: false;
      reason: 'no_workspace_sender' | 'sender_not_assigned';
      message: string;
    };

export function evaluateInstallationSenderPolicy(input: {
  installationId?: string | null;
  selectedPhoneNumberId: string;
  selectedSenderKey: string;
  senderProfiles: InstallationSenderProfileSnapshot[];
}): InstallationSenderPolicyResult {
  if (!input.installationId) {
    return { allowed: true };
  }

  const matchingProfile = input.senderProfiles.find((profile) => {
    const profileMatchesSender =
      profile.phoneNumberId === input.selectedPhoneNumberId ||
      profile.senderKey === input.selectedSenderKey;

    return profileMatchesSender && profile.phoneNumberActive !== false;
  });

  if (matchingProfile) {
    return {
      allowed: true,
      matchedProfileId: matchingProfile.id,
    };
  }

  const hasWorkspaceSender = input.senderProfiles.some(
    (profile) => profile.phoneNumberActive === true
  );

  return hasWorkspaceSender
    ? {
        allowed: false,
        reason: 'sender_not_assigned',
        message: 'The selected sender number is not assigned to this connected CRM workspace.',
      }
    : {
        allowed: false,
        reason: 'no_workspace_sender',
        message:
          'No active sender is configured for this connected CRM workspace. Assign a sender number before sending.',
      };
}
