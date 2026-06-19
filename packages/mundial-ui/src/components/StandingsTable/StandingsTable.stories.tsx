import type { Meta, StoryObj } from '@storybook/react';
import { StandingsTable } from './StandingsTable';

const meta: Meta<typeof StandingsTable> = {
  title: 'Standings/StandingsTable',
  component: StandingsTable,
  decorators: [(S) => <div style={{ width: 360 }}><S /></div>]
};
export default meta;
type Story = StoryObj<typeof StandingsTable>;

export const GroupA: Story = {
  args: {
    group: 'A',
    rows: [
      { code: 'MEX', name: 'Mexico', P: 2, W: 2, D: 0, L: 0, GD: 3, Pts: 6 },
      { code: 'KOR', name: 'South Korea', P: 2, W: 1, D: 0, L: 1, GD: 1, Pts: 3 },
      { code: 'CZE', name: 'Czechia', P: 2, W: 0, D: 1, L: 1, GD: -1, Pts: 1 },
      { code: 'RSA', name: 'South Africa', P: 2, W: 0, D: 1, L: 1, GD: -3, Pts: 1 }
    ]
  }
};
