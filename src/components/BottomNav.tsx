import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { API } from '@/lib/api';
import { Icon } from '@/components/atoms/Icon';

function TabButton({
  label,
  active,
  onClick,
  icon,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}
      <span className="label">{label}</span>
      {badge && badge > 0 ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  // Incoming pending offers drive the Offers badge — a real, meaningful count.
  const { data: incoming } = useQuery({
    queryKey: ['offers', 'seller'],
    queryFn: () => API.getMyOffers('seller'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const offersBadge = (incoming?.offers ?? []).filter((o) => o.status === 'pending').length;

  return (
    <nav className="bottom-nav">
      <TabButton label="Market" icon={Icon.navMarket} active={path.startsWith('/marketplace')} onClick={() => navigate('/marketplace')} />
      <TabButton label="Offers" icon={Icon.navOffers} active={path.startsWith('/offers')} onClick={() => navigate('/offers')} badge={offersBadge} />
      <TabButton label="Messages" icon={Icon.navMessages} active={path.startsWith('/messages')} onClick={() => navigate('/messages')} />
      <TabButton label="Profile" icon={Icon.navProfile} active={path.startsWith('/profile')} onClick={() => navigate('/profile')} />
    </nav>
  );
}
