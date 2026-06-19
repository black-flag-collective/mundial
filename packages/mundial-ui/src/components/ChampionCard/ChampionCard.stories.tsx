import type { Meta, StoryObj } from '@storybook/react';
import { ChampionCard } from './ChampionCard';

const meta: Meta<typeof ChampionCard> = {
  title: 'Bracket/ChampionCard',
  component: ChampionCard
};
export default meta;
type Story = StoryObj<typeof ChampionCard>;

export const Default: Story = {
  args: {
    final: {
      teamA: { code: 'ESP', name: 'Spain', winner: true },
      teamB: { code: 'ARG', name: 'Argentina' }
    },
    champion: { code: 'ESP', name: 'Spain' }
  }
};
