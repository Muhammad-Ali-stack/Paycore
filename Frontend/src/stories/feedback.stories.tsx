import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Progress } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, InlineError } from '@/components/states/states';
import { ApiError } from '@/lib/api/errors';

const meta = { title: 'Design system/Feedback', component: EmptyState, args: { title: 'No cards yet' } } satisfies Meta<
  typeof EmptyState
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Neutral</Badge>
      <Badge tone="accent">Tier 2</Badge>
      <Badge tone="success" dot>
        Completed
      </Badge>
      <Badge tone="warning" dot>
        Pending
      </Badge>
      <Badge tone="danger" dot>
        Failed
      </Badge>
      {['COMPLETED', 'PROCESSING', 'PARTIALLY_REFUNDED', 'FROZEN', 'EXPIRED', 'CRITICAL'].map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  ),
};

export const Empty: Story = {
  args: {
    title: 'No cards yet',
    body: 'Create a virtual card to pay online without sharing your wallet details.',
    action: <Button>New card</Button>,
  },
};

export const Error: Story = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <ErrorState
        error={new ApiError({ status: 422, code: 'INSUFFICIENT_FUNDS', message: 'x', correlationId: 'c-9f3a21' })}
        onRetry={fn()}
      />
      <InlineError
        error={new ApiError({ status: 422, code: 'PIN_INVALID', message: 'x', details: { attemptsRemaining: 2 } })}
      />
      <InlineError
        error={new ApiError({ status: 422, code: 'LIMIT_EXCEEDED', message: 'x', details: { limit: 'DAILY' } })}
      />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="grid max-w-md gap-6">
      <ListSkeleton rows={4} label="Loading items" />
      <Spinner label="Loading" />
      <Progress value={62} label="KYC progress" />
    </div>
  ),
};
