import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { renderWithProviders } from '@/test/render';
import { PinSheet } from './pin-sheet';
import { ApiError } from '@/lib/api/errors';

function Harness(props: Partial<React.ComponentProps<typeof PinSheet>> & { onSubmit?: (pin: string) => void }) {
  const [open, setOpen] = React.useState(true);
  return <PinSheet open={open} onOpenChange={setOpen} onSubmit={props.onSubmit ?? (() => undefined)} {...props} />;
}

describe('PinSheet', () => {
  it('is an accessible dialog with a labelled PIN field', async () => {
    renderWithProviders(<Harness />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Enter your PIN');
    expect(screen.getByLabelText('PIN')).toHaveAttribute('type', 'password');
    const results = await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('enables confirm only after 4+ digits and submits the PIN', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<Harness onSubmit={onSubmit} />);
    const confirm = await screen.findByTestId('pin-confirm');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('PIN'), '123');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('PIN'), '4');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith('1234');
  });

  it('while pending: confirm is disabled and busy, and the sheet cannot be dismissed', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<Harness onSubmit={onSubmit} pending />);
    const confirm = await screen.findByTestId('pin-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('PIN_INVALID clears the field and shows attempts remaining', async () => {
    const { rerender } = renderWithProviders(<Harness />);
    await userEvent.type(await screen.findByLabelText('PIN'), '9999');
    rerender(
      <Harness
        error={new ApiError({ status: 422, code: 'PIN_INVALID', message: 'x', details: { attemptsRemaining: 3 } })}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('PIN')).toHaveValue(''));
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect PIN. 3 attempts left.');
    expect(screen.getByLabelText('PIN')).toHaveAttribute('aria-invalid', 'true');
  });

  it('PIN_LOCKED disables entry', async () => {
    renderWithProviders(
      <Harness
        error={
          new ApiError({
            status: 423,
            code: 'PIN_LOCKED',
            message: 'x',
            details: { lockedUntil: '2030-01-01T00:00:00Z' },
          })
        }
      />,
    );
    expect(await screen.findByLabelText('PIN')).toBeDisabled();
    expect(screen.getByTestId('pin-confirm')).toBeDisabled();
  });

  it('shows a still-processing hint while retrying with the same key', async () => {
    renderWithProviders(<Harness pending retrying />);
    expect(await screen.findByText('Still processing, checking again…')).toBeInTheDocument();
  });
});
