import type { Meta, StoryObj } from '@storybook/react';
import { FeaturedMatch } from './FeaturedMatch';

const meta: Meta<typeof FeaturedMatch> = {
  title: 'Matchday/FeaturedMatch',
  component: FeaturedMatch
};
export default meta;
type Story = StoryObj<typeof FeaturedMatch>;

export const Final: Story = {
  args: {
    group: 'I', state: 'final', score: '3 – 1', status: 'Full Time',
    venue: 'MetLife Stadium, NJ',
    teamA: { code: 'FRA', name: 'France' },
    teamB: { code: 'SEN', name: 'Senegal' }
  }
};
export const Upcoming: Story = {
  args: {
    group: 'B', state: 'upcoming', status: '6:00 PM ET',
    venue: 'BMO Field, Toronto',
    teamA: { code: 'SUI', name: 'Switzerland' },
    teamB: { code: 'BIH', name: 'Bosnia & Herzegovina' }
  }
};
