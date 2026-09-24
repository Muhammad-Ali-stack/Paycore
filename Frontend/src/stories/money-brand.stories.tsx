import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Amount } from '@/components/money/amount';
import { Logo, LogoMark } from '@/components/brand/logo';
import { IsoBlocks, LoadingMark } from '@/components/brand/iso-blocks';
import { BalanceCard } from '@/features/wallets/balance-carousel';
import { VirtualCard } from '@/features/cards/virtual-card';
import { QrCode } from '@/features/qr/qr-code';
import { Receipt } from '@/features/receipt/receipt';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Button } from '@/components/ui/button';
import type { Card } from '@/lib/api/contracts/future';
import type { Wallet } from '@/lib/api/contracts/phase1';

const meta = {
  title: 'Design system/Money & brand',
  component: Amount,
  args: { money: { currency: 'PKR', amountMinor: '4094220050' }, size: 'xl' },
} satisfies Meta<typeof Amount>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Money: Story = {};
export const MoneyScale: Story = {
  render: () => (
    <div className="grid gap-2">
      <Amount money={{ currency: 'PKR', amountMinor: '4094220050' }} size="hero" className="text-accent-text" />
      <Amount money={{ currency: 'USD', amountMinor: '279200' }} size="xl" />
      <Amount money={{ currency: 'AED', amountMinor: '297100' }} size="lg" />
      <Amount money={{ currency: 'PKR', amountMinor: '250000' }} direction="IN" />
      <Amount money={{ currency: 'PKR', amountMinor: '87500' }} direction="OUT" />
      <Amount money={{ currency: 'USD', amountMinor: '9223372036854775807' }} size="sm" />
    </div>
  ),
};

export const Brand: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-8">
      <Logo />
      <LogoMark className="size-16" />
      <IsoBlocks count={4} filled={2} className="h-28" />
      <LoadingMark label="Loading page" />
    </div>
  ),
};

const wallet: Wallet = {
  id: 'w1',
  currency: 'PKR',
  status: 'ACTIVE',
  balance: { currency: 'PKR', amount: '409422.00', amountMinor: '40942200' },
  createdAt: '2026-01-01T00:00:00Z',
};
const card: Card = {
  id: 'c1',
  walletId: 'w1',
  currency: 'USD',
  type: 'VIRTUAL',
  status: 'ACTIVE',
  label: 'Subscriptions',
  brand: 'VISA',
  last4: '9034',
  expiryMonth: 11,
  expiryYear: 2029,
  cardholderName: 'AYESHA KHAN',
  limits: {
    perTransaction: { currency: 'USD', amount: '500.00', amountMinor: '50000' },
    daily: { currency: 'USD', amount: '1000.00', amountMinor: '100000' },
    monthly: { currency: 'USD', amount: '3000.00', amountMinor: '300000' },
    ecommerce: true,
    international: true,
  },
  spentThisMonth: { currency: 'USD', amount: '142.00', amountMinor: '14200' },
  createdAt: '2026-01-01T00:00:00Z',
};

export const WalletAndCard: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <BalanceCard wallet={wallet} active />
      <BalanceCard
        wallet={{
          ...wallet,
          id: 'w2',
          currency: 'AED',
          status: 'FROZEN',
          balance: { currency: 'AED', amount: '120.00', amountMinor: '12000' },
        }}
      />
      <VirtualCard card={card} selected />
      <VirtualCard
        card={card}
        secrets={{
          pan: '4000567856789034',
          cvv: '381',
          expiryMonth: 11,
          expiryYear: 2029,
          hideAt: '2030-01-01T00:00:00Z',
        }}
      />
      <VirtualCard card={{ ...card, status: 'FROZEN', label: 'Travel', last4: '1177', currency: 'AED' }} />
    </div>
  ),
};

export const QrAndReceipt: Story = {
  render: () => (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <QrCode payload="PC1.eyJ2IjoxLCJxaWQiOiJkZW1vIn0.c2ln" label="PayCore QR code" />
      <Receipt
        status="success"
        title="Sent"
        amount={<Amount money={{ currency: 'PKR', amountMinor: '500000' }} size="xl" />}
        subtitle="Rs 5,000.00 is on its way to Sara A."
        shareText="PayCore receipt"
        actions={<Button>Done</Button>}
      >
        <DetailList>
          <DetailRow label="Fee">Rs 50.00</DetailRow>
          <DetailRow label="Payment ID">9F3A21C4</DetailRow>
        </DetailList>
      </Receipt>
    </div>
  ),
};
