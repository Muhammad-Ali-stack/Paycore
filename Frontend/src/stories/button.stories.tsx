import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

const meta = {
  title: 'Design system/Button',
  component: Button,
  args: { children: 'Send money', onClick: fn() },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'] },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon', 'icon-sm'] },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Outline: Story = { args: { variant: 'outline' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Close card' } };
export const Loading: Story = { args: { loading: true, children: 'Authorising…' } };
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Send aria-hidden /> Send
      </>
    ),
  },
};
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {(['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'] as const).map((v) => (
        <Button key={v} variant={v}>
          {v}
        </Button>
      ))}
      <Button disabled>Disabled</Button>
      <Button size="lg">Large</Button>
      <Button size="sm">Small</Button>
    </div>
  ),
};
