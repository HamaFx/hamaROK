import { getTierConfig, WarriorTier } from '@/lib/warrior-score';

interface TierBadgeProps {
  tier: WarriorTier;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export default function TierBadge({ tier, size = 'md', showLabel = true }: TierBadgeProps) {
  const config = getTierConfig(tier);
  const sizeClass = size === 'sm' ? 'text-sm' : size === 'lg' ? '' : '';

  return (
    <span className={`tier-badge ${config.bgClass} ${sizeClass}`}>
      {config.emoji}
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}
