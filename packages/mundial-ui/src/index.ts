// Mundial design system — public API.
// Importing the package pulls in the compiled styles (tokens + component CSS).
import './styles/styles.css';

// ---- Primitives ----
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

// ---- Matchday ----
export { MatchCard } from './components/MatchCard/MatchCard';
export type { MatchCardProps, MatchTeam } from './components/MatchCard/MatchCard';

export { FeaturedMatch } from './components/FeaturedMatch/FeaturedMatch';
export type { FeaturedMatchProps } from './components/FeaturedMatch/FeaturedMatch';

export { DayTimeline } from './components/DayTimeline/DayTimeline';
export type { DayTimelineProps } from './components/DayTimeline/DayTimeline';

// ---- Standings ----
export { StandingsTable } from './components/StandingsTable/StandingsTable';
export type { StandingsTableProps, StandingRow } from './components/StandingsTable/StandingsTable';

// ---- Bracket ----
export { BracketMatch } from './components/BracketMatch/BracketMatch';
export type { BracketMatchProps, BracketTeam } from './components/BracketMatch/BracketMatch';

export { BracketColumn } from './components/BracketColumn/BracketColumn';
export type { BracketColumnProps } from './components/BracketColumn/BracketColumn';

export { ChampionCard } from './components/ChampionCard/ChampionCard';
export type { ChampionCardProps } from './components/ChampionCard/ChampionCard';

// ---- Globe panels ----
export { ConfederationLegend } from './components/ConfederationLegend/ConfederationLegend';
export type { ConfederationLegendProps } from './components/ConfederationLegend/ConfederationLegend';

export { CountryHero } from './components/CountryHero/CountryHero';
export type { CountryHeroProps } from './components/CountryHero/CountryHero';

export { FixtureList } from './components/FixtureList/FixtureList';
export type { FixtureListProps, Fixture } from './components/FixtureList/FixtureList';

// ---- Data + helpers ----
export { flagUrl, FIFA_TO_ISO } from './lib/flags';
export { TEAMS, TEAM_BY_CODE, teamName } from './data/teams';
export type { Team } from './data/teams';
export { CONFEDERATIONS, CONFEDERATION_LIST } from './data/confederations';
export type { Confederation, ConfederationInfo } from './data/confederations';
