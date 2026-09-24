import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { PinSheet } from '@/components/pin-sheet';
import { Amount } from '@/components/money/amount';
import { ApiError } from '@/lib/api/errors';

const summary = (
  <DetailList>
    <DetailRow label="Recipient">Sara A.</DetailRow>
    <DetailRow label="They get">
      <Amount money={{ currency: 'AED', amountMinor: '6512' }} />
    </DetailRow>
    <DetailRow label="Total debited" emphasis>
      <Amount money={{ currency: 'PKR', amountMinor: '505000' }} />
    </DetailRow>
  </DetailList>
);

const meta = {
  title: 'Design system/Overlays',
  component: PinSheet,
  args: { open: true, onOpenChange: fn(), onSubmit: fn(), summary },
} satisfies Meta<typeof PinSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PinConfirm: Story = {};
export const PinPending: Story = { args: { pending: true } };
export const PinWrong: Story = {
  args: { error: new ApiError({ status: 422, code: 'PIN_INVALID', message: 'x', details: { attemptsRemaining: 3 } }) },
};
export const PinLocked: Story = {
  args: {
    error: new ApiError({
      status: 423,
      code: 'PIN_LOCKED',
      message: 'x',
      details: { lockedUntil: '2030-01-01T00:00:00Z' },
    }),
  },
};

export const DialogSheet: Story = {
  render: () => {
    function Demo() {
      const [open, setOpen] = React.useState(false);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Open dialog</Button>
          </DialogTrigger>
          <DialogContent closeLabel="Close">
            <DialogHeader>
              <DialogTitle>Open a new wallet</DialogTitle>
              <DialogDescription>Bottom sheet on phones, centred modal on larger screens.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setOpen(false)}>Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
    return <Demo />;
  },
};
