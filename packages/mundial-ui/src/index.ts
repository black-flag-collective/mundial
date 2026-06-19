// Mundial design system — public API.
// Importing the package pulls in the compiled styles (tokens + component CSS).
import './styles/styles.css';

export { Brand } from './components/Brand/Brand';
export type { BrandProps } from './components/Brand/Brand';

export { Eyebrow } from './components/Eyebrow/Eyebrow';
export type { EyebrowProps } from './components/Eyebrow/Eyebrow';

export { Flag } from './components/Flag/Flag';
export type { FlagProps, FlagSize } from './components/Flag/Flag';

export { Pill } from './components/Pill/Pill';
export type { PillProps } from './components/Pill/Pill';

export { NavPills } from './components/NavPills/NavPills';
export type { NavPillsProps, NavItem } from './components/NavPills/NavPills';

export { StatusBadge } from './components/StatusBadge/StatusBadge';
export type { StatusBadgeProps, StatusVariant } from './components/StatusBadge/StatusBadge';

export { flagUrl, FIFA_TO_ISO } from './lib/flags';
