import './NavPills.css';
import { Pill } from '../Pill/Pill';

export interface NavItem {
  /** Stable id passed to onChange. */
  id: string;
  /** Visible label. */
  label: string;
}

export interface NavPillsProps {
  items: NavItem[];
  /** id of the active item. */
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * The glassmorphic segmented nav used to switch views (Globe · Matchday ·
 * Standings · Bracket). Renders a <Pill> per item inside a blurred container.
 */
export function NavPills({ items, value, onChange, className }: NavPillsProps) {
  return (
    <div className={['mun-navpills', className].filter(Boolean).join(' ')} role="tablist">
      {items.map((item) => (
        <Pill key={item.id} active={item.id === value} onClick={() => onChange(item.id)}>
          {item.label}
        </Pill>
      ))}
    </div>
  );
}
