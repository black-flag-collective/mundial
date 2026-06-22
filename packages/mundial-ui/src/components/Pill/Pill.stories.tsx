import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pill } from './Pill';

const meta: Meta<typeof Pill> = {
  title: 'Primitives/Pill',
  component: Pill,
  args: { children: 'Matchday', active: false }
};
export default meta;
type Story = StoryObj<typeof Pill>;

export const Inactive: Story = {};
export const Active: Story = { args: { active: true } };
