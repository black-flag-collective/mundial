import type { Meta, StoryObj } from '@storybook/react-vite';
import { Eyebrow } from './Eyebrow';

const meta: Meta<typeof Eyebrow> = {
  title: 'Primitives/Eyebrow',
  component: Eyebrow,
  args: { children: 'FIFA World Cup 26 · Group Stage', tone: 'default' }
};
export default meta;
type Story = StoryObj<typeof Eyebrow>;

export const Default: Story = {};
export const Strong: Story = { args: { tone: 'strong' } };
export const Subtle: Story = { args: { tone: 'subtle', children: 'Confederations' } };
