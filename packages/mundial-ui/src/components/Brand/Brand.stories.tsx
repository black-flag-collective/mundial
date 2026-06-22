import type { Meta, StoryObj } from '@storybook/react-vite';
import { Brand } from './Brand';

const meta: Meta<typeof Brand> = {
  title: 'Primitives/Brand',
  component: Brand,
  args: { size: 26, markOnly: false }
};
export default meta;
type Story = StoryObj<typeof Brand>;

export const Default: Story = {};
export const MarkOnly: Story = { args: { markOnly: true } };
export const Large: Story = { args: { size: 48 } };
