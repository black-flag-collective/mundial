import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { NavPills, type NavItem } from './NavPills';

const ITEMS: NavItem[] = [
  { id: 'globe', label: 'Globe' },
  { id: 'matchday', label: 'Matchday' },
  { id: 'standings', label: 'Standings' },
  { id: 'bracket', label: 'Bracket' }
];

const meta: Meta<typeof NavPills> = {
  title: 'Primitives/NavPills',
  component: NavPills
};
export default meta;
type Story = StoryObj<typeof NavPills>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('globe');
    return <NavPills items={ITEMS} value={value} onChange={setValue} />;
  }
};
