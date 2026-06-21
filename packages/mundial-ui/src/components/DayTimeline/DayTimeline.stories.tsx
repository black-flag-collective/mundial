import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { DayTimeline } from './DayTimeline';

const DAYS = ['Jun 11', 'Jun 12', 'Jun 13', 'Jun 14', 'Jun 15', 'Jun 16', 'Jun 17', 'Jun 18'];

const meta: Meta<typeof DayTimeline> = {
  title: 'Matchday/DayTimeline',
  component: DayTimeline,
  decorators: [(S) => <div style={{ width: 560 }}><S /></div>]
};
export default meta;
type Story = StoryObj<typeof DayTimeline>;

export const Default: Story = {
  render: () => {
    const [day, setDay] = useState(7);
    return <DayTimeline days={DAYS} value={day} onChange={setDay} />;
  }
};
