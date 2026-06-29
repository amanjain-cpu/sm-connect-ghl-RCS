import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ListChecks,
  Building2,
  Megaphone,
  Phone,
  MessageSquare,
  Plug,
  CreditCard,
  Settings,
  HelpCircle,
  ChevronLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Onboarding', href: '/onboarding', icon: ListChecks },
  { name: 'Brands', href: '/brands', icon: Building2 },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { name: 'Phone Numbers', href: '/phone-numbers', icon: Phone },
  { name: 'Messages', href: '/messages', icon: MessageSquare },
  { name: 'Platforms', href: '/platforms', icon: Plug },
  { name: 'Billing', href: '/subscriptions', icon: CreditCard },
];

const secondaryNavigation = [
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Help & Support', href: '/help', icon: HelpCircle },
];

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  mobileOnly?: boolean;
};

export function Sidebar({ collapsed, onToggle, mobileOnly = false }: SidebarProps) {
  const location = useLocation();
  const { user, organization } = useAuthStore();

  const getInitials = () => {
    if (!user) return 'U';
    return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`;
  };

  const userName = user ? `${user.firstName} ${user.lastName}` : 'Workspace user';
  const orgLabel = organization?.name ?? 'Admin workspace';

  if (mobileOnly) {
    return (
      <div className="sticky top-0 z-40 lg:hidden">
        <div className="flex items-center justify-between border-b border-black/5 bg-white/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <img src="/icon-color.png" alt="" className="h-10 w-10 shrink-0" />
            <div className="text-[18px] font-bold leading-none tracking-[-0.015em]">
              <span className="text-[#2FB267]">Mash</span>
              <span className="text-[#111827]">Connect</span>
            </div>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#2FB267] text-xs font-bold text-white">
            {getInitials()}
          </div>
        </div>
        <nav className="scrollbar-hide flex gap-2 overflow-x-auto border-b border-black/5 bg-white px-4 py-3">
          {navigation.map((item) => {
            const isActive = location.pathname.startsWith(item.href);
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-[#2FB267] text-white' : 'bg-black/[0.04] text-[#4B5563]'
                )}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        'relative z-20 hidden h-full min-h-0 shrink-0 self-stretch flex-col bg-gradient-to-b from-[#3DC077] to-[#2FB267] text-white transition-all duration-200 lg:flex',
        collapsed ? 'w-[72px]' : 'w-[228px]'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        title={collapsed ? 'Expand' : 'Collapse'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'absolute bottom-[66px] right-[-11px] z-30 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-black/5 bg-white p-0 text-[#1F7E4A] shadow-[0_6px_18px_rgba(17,24,39,0.18),0_0_0_1px_rgba(17,24,39,0.04)] transition-transform',
          collapsed && 'rotate-180'
        )}
      >
        <ChevronLeft className="h-3 w-3 stroke-[2.5]" />
      </button>

      <div className="flex-1 overflow-y-auto px-2.5 py-4">
        {!collapsed ? (
          <div className="px-3 pb-2 text-[10.5px] font-bold uppercase tracking-[0.10em] text-white/80">
            Workspace
          </div>
        ) : null}

        <nav className="space-y-[3px]">
          {navigation.map((item) => {
            const isActive = location.pathname.startsWith(item.href);
            return (
              <NavLink
                key={item.name}
                to={item.href}
                title={collapsed ? item.name : undefined}
                className={cn(
                  'relative flex items-center gap-3 rounded-[10px] px-3 py-[11px] text-[13.5px] font-medium text-white transition-colors',
                  isActive ? 'bg-white font-bold text-[#1F7E4A] shadow-[0_2px_8px_-2px_rgba(17,24,39,0.20)]' : 'hover:bg-white/15',
                  collapsed && 'mx-[10px] justify-center px-0'
                )}
              >
                <item.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-[#1F7E4A]')} />
                {!collapsed ? <span className="truncate">{item.name}</span> : null}
              </NavLink>
            );
          })}
        </nav>

        {!collapsed ? (
          <div className="mt-3 px-3 pb-2 pt-4 text-[10.5px] font-bold uppercase tracking-[0.10em] text-white/80">
            Support
          </div>
        ) : null}

        <nav className="space-y-[3px]">
          {secondaryNavigation.map((item) => {
            const isActive = location.pathname.startsWith(item.href);
            return (
              <NavLink
                key={item.name}
                to={item.href}
                title={collapsed ? item.name : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-[10px] px-3 py-[11px] text-[13.5px] font-medium text-white transition-colors',
                  isActive ? 'bg-white font-bold text-[#1F7E4A] shadow-[0_2px_8px_-2px_rgba(17,24,39,0.20)]' : 'hover:bg-white/15',
                  collapsed && 'mx-[10px] justify-center px-0'
                )}
              >
                <item.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-[#1F7E4A]')} />
                {!collapsed ? <span className="truncate">{item.name}</span> : null}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2.5 border-t border-white/15 bg-black/10 px-[14px] py-3">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-white text-[11px] font-bold text-[#1F7E4A] shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]">
          {getInitials()}
        </div>

        {!collapsed ? (
          <>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold leading-[1.2] text-white">{userName}</div>
              <div className="truncate text-[11px] leading-[1.2] text-white/70">{orgLabel}</div>
            </div>
            <NavLink
              to="/settings"
              className="ml-auto rounded-full p-1 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Open settings"
            >
              <Settings className="h-[15px] w-[15px] shrink-0" />
            </NavLink>
          </>
        ) : null}
      </div>
    </aside>
  );
}
