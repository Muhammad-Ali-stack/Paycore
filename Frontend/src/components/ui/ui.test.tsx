import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { renderWithProviders } from '@/test/render';
import { Button } from './button';
import { Field, Input, PasswordInput } from './input';
import { Badge, statusTone } from './badge';
import { CodeInput } from './code-input';
import { Segmented } from './primitives';
import { StatusBadge } from './status-badge';
import { DetailList, DetailRow } from './detail-list';
import { Amount } from '@/components/money/amount';
import { AmountInput } from '@/components/money/amount-input';
import { EmptyState, ErrorState } from '@/components/states/states';
import { ApiError } from '@/lib/api/errors';
import { useUiStore } from '@/stores/ui';

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

describe('Button', () => {
  it('renders variants and handles clicks', async () => {
    const onClick = vi.fn();
    renderWithProviders(<Button onClick={onClick}>Pay</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Pay' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('loading disables the button and marks it busy (no double submits)', async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <Button loading onClick={onClick}>
        Pay
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Pay' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
  it('asChild renders the child element with button styling', () => {
    renderWithProviders(
      <Button asChild variant="outline">
        <a href="/send">Send</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Send' });
    expect(link.className).toMatch(/border-border/);
  });
});

describe('Field', () => {
  it('wires label, aria-invalid and aria-describedby to the control', () => {
    renderWithProviders(
      <Field label="Phone number" hint="Include your country code" error="Enter a valid phone">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Phone number');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy.split(' ')[0]!)).toHaveTextContent('Enter a valid phone');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid phone');
  });
  it('password input toggles visibility with a labelled button', async () => {
    renderWithProviders(
      <Field label="Password">
        <PasswordInput showLabel="Show password" hideLabel="Hide password" />
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
  });
  it('has no axe violations', async () => {
    const { container } = renderWithProviders(
      <form>
        <Field label="Full name" hint="As on your CNIC">
          <Input />
        </Field>
        <Button type="submit">Save</Button>
      </form>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('Badge / StatusBadge', () => {
  it('maps statuses to muted semantic tones', () => {
    expect(statusTone('COMPLETED')).toBe('success');
    expect(statusTone('FAILED')).toBe('danger');
    expect(statusTone('PENDING')).toBe('warning');
    expect(statusTone('EXPIRED')).toBe('neutral');
  });
  it('translates known statuses and falls back to raw text', () => {
    renderWithProviders(
      <>
        <StatusBadge status="PARTIALLY_REFUNDED" />
        <StatusBadge status="SOMETHING_NEW" />
        <Badge tone="accent">Tier 2</Badge>
      </>,
    );
    expect(screen.getByText('Partly refunded')).toBeInTheDocument();
    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument();
  });
});

describe('CodeInput (PIN / OTP)', () => {
  it('keeps digits only, caps length and reports completion', async () => {
    const onComplete = vi.fn();
    function Harness() {
      const [v, setV] = React.useState('');
      return <CodeInput length={6} value={v} onChange={setV} onComplete={onComplete} aria-label="Code" />;
    }
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText('Code');
    await userEvent.type(input, '12a3-45678');
    expect(input).toHaveValue('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
  it('masks PINs', () => {
    renderWithProviders(<CodeInput length={6} mask value="12" onChange={() => undefined} aria-label="PIN" />);
    expect(screen.getByLabelText('PIN')).toHaveAttribute('type', 'password');
  });
});

describe('Segmented', () => {
  it('is a radiogroup with arrow-key navigation', async () => {
    function Harness() {
      const [v, setV] = React.useState<'a' | 'b' | 'c'>('a');
      return (
        <Segmented
          label="Period"
          value={v}
          onChange={setV}
          options={[
            { value: 'a', label: '30 days' },
            { value: 'b', label: '90 days' },
            { value: 'c', label: '12 months' },
          ]}
        />
      );
    }
    renderWithProviders(<Harness />);
    const first = screen.getByRole('radio', { name: '30 days' });
    expect(first).toHaveAttribute('aria-checked', 'true');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '90 days' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Amount', () => {
  it('formats from minor units with tabular money class', () => {
    renderWithProviders(<Amount money={{ currency: 'USD', amountMinor: '125050' }} />);
    const el = screen.getByText('$1,250.50');
    expect(el).toHaveClass('money');
  });
  it('shows signs by direction', () => {
    renderWithProviders(
      <>
        <Amount money={{ currency: 'USD', amountMinor: '500' }} direction="IN" />
        <Amount money={{ currency: 'USD', amountMinor: '500' }} direction="OUT" />
      </>,
    );
    expect(screen.getByText('+$5.00')).toBeInTheDocument();
    expect(screen.getByText('−$5.00')).toBeInTheDocument();
  });
  it('respects the hide-balances privacy toggle only when hideable', () => {
    act(() => useUiStore.setState({ hideBalances: true }));
    renderWithProviders(
      <>
        <Amount money={{ currency: 'USD', amountMinor: '999' }} hideable />
        <Amount money={{ currency: 'USD', amountMinor: '111' }} />
      </>,
    );
    expect(screen.queryByText('$9.99')).not.toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByText('$1.11')).toBeInTheDocument();
    act(() => useUiStore.setState({ hideBalances: false }));
  });
});

describe('AmountInput', () => {
  it('limits decimals to the currency exponent and strips junk', () => {
    function Harness() {
      const [v, setV] = React.useState('');
      return <AmountInput currency="PKR" value={v} onValueChange={setV} aria-label="Amount" />;
    }
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText('Amount');
    fireEvent.change(input, { target: { value: '1,2a50.567' } });
    expect(input).toHaveValue('1250.56');
    fireEvent.change(input, { target: { value: '1.2.3' } });
    expect(input).toHaveValue('1.23');
  });
});

describe('States', () => {
  it('ErrorState translates contract errors, shows the correlation id and retries', async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <ErrorState
        error={new ApiError({ status: 422, code: 'INSUFFICIENT_FUNDS', message: 'x', correlationId: 'c-123' })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough balance in this wallet.');
    expect(screen.getByText(/c-123/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('ErrorState shows PIN attempts remaining and limit kinds', () => {
    renderWithProviders(
      <>
        <ErrorState
          error={new ApiError({ status: 422, code: 'PIN_INVALID', message: 'x', details: { attemptsRemaining: 2 } })}
        />
        <ErrorState
          error={new ApiError({ status: 422, code: 'LIMIT_EXCEEDED', message: 'x', details: { limit: 'DAILY' } })}
        />
      </>,
    );
    expect(screen.getByText('Incorrect PIN. 2 attempts left.')).toBeInTheDocument();
    expect(screen.getByText('This would exceed your daily limit.')).toBeInTheDocument();
  });
  it('EmptyState renders title, body and action accessibly', async () => {
    const { container } = renderWithProviders(
      <EmptyState title="No cards yet" body="Create one" action={<Button>New card</Button>} />,
    );
    expect(screen.getByRole('heading', { name: 'No cards yet' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
  it('DetailList renders a description list', () => {
    renderWithProviders(
      <DetailList>
        <DetailRow label="Fee">Free</DetailRow>
      </DetailList>,
    );
    expect(screen.getByText('Fee').tagName).toBe('DT');
  });
});

describe('RTL', () => {
  it('money stays LTR-isolated inside Urdu text', () => {
    document.documentElement.dir = 'rtl';
    renderWithProviders(<Amount money={{ currency: 'PKR', amountMinor: '125050' }} />, { locale: 'ur' });
    const el = document.querySelector('.money')!;
    expect(el.textContent!.replace(/[^\d.,]/g, '')).toBe('1,250.50');
    document.documentElement.dir = 'ltr';
  });
  it('renders Urdu translations', () => {
    renderWithProviders(<StatusBadge status="COMPLETED" />, { locale: 'ur' });
    expect(screen.getByText('مکمل')).toBeInTheDocument();
  });
});
