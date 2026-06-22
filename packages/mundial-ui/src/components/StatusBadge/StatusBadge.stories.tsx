import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusBadge } from './StatusBadge';

const meta: Meta<typeof StatusBadge> = {
  title: 'Primitives/StatusBadge',
  component: StatusBadge,
  args: { variant: 'final' }
};
export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Final: Story = { args: { variant: 'final' } };
export const Upcoming: Story = { args: { variant: 'upcoming', children: '6:00 PM ET' } };
export const Today: Story = { args: { variant: 'today' } };
