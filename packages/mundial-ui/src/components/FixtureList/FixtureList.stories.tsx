import type { Meta, StoryObj } from '@storybook/react-vite';
import { FixtureList } from './FixtureList';
import { CONFEDERATIONS } from '../../data/confederations';

const meta: Meta<typeof FixtureList> = {
  title: 'Globe/FixtureList',
  component: FixtureList,
  decorators: [(S) => <div style={{ width: 340 }}><S /></div>]
};
export default meta;
type Story = StoryObj<typeof FixtureList>;

export const GroupC: Story = {
  args: {
    group: 'C',
    accentColor: CONFEDERATIONS.CONMEBOL.color,
    fixtures: [
      { oppCode: 'MAR', oppName: 'Morocco', venue: 'New York / New Jersey', date: 'Jun 13' },
      { oppCode: 'HAI', oppName: 'Haiti', venue: 'SoFi Stadium, LA', date: 'Jun 18' },
      { oppCode: 'SCO', oppName: 'Scotland', venue: 'Group C', date: 'TBD' }
    ]
  }
};
