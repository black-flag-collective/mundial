import type { Meta, StoryObj } from '@storybook/react-vite';
import { BracketColumn } from './BracketColumn';
import { BracketMatch } from '../BracketMatch/BracketMatch';

const meta: Meta<typeof BracketColumn> = {
  title: 'Bracket/BracketColumn',
  component: BracketColumn,
  decorators: [(S) => <div style={{ height: 320, display: 'flex' }}><S /></div>]
};
export default meta;
type Story = StoryObj<typeof BracketColumn>;

export const QuarterFinals: Story = {
  args: {
    label: 'QF',
    children: (
      <>
        <BracketMatch teamA={{ code: 'ESP', name: 'Spain', winner: true }} teamB={{ code: 'NED', name: 'Netherlands' }} />
        <BracketMatch teamA={{ code: 'ARG', name: 'Argentina', winner: true }} teamB={{ code: 'BRA', name: 'Brazil' }} />
      </>
    )
  }
};
