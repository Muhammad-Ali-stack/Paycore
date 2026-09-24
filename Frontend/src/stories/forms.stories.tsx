import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Field, Input, PasswordInput, Textarea } from '@/components/ui/input';
import { CodeInput } from '@/components/ui/code-input';
import {
  Checkbox,
  Segmented,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { AmountInput } from '@/components/money/amount-input';

function FormsShowcase() {
  const [pin, setPin] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [amount, setAmount] = React.useState('1250.50');
  const [cur, setCur] = React.useState('PKR');
  const [period, setPeriod] = React.useState<'30' | '90' | '365'>('30');
  const [on, setOn] = React.useState(true);
  return (
    <div className="grid max-w-md gap-6">
      <Field label="Phone number" hint="Include your country code">
        <Input placeholder="+923001234567" />
      </Field>
      <Field label="Phone number" error="Enter a phone number with country code">
        <Input defaultValue="0300" />
      </Field>
      <Field label="Password">
        <PasswordInput showLabel="Show password" hideLabel="Hide password" />
      </Field>
      <Field label="Address" optional="Optional">
        <Textarea />
      </Field>
      <Field label="Currency">
        <Select
          value={cur}
          onValueChange={setCur}
          options={['PKR', 'AED', 'USD'].map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <div className="grid gap-1.5">
        <label htmlFor="sb-amount" className="text-sm font-medium">
          Amount
        </label>
        <AmountInput id="sb-amount" currency="PKR" value={amount} onValueChange={setAmount} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">PIN (masked, 4–6 digits)</span>
        <CodeInput length={6} minLength={4} mask value={pin} onChange={setPin} aria-label="PIN" />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">OTP</span>
        <CodeInput length={6} value={otp} onChange={setOtp} aria-label="Verification code" />
      </div>
      <Segmented
        label="Period"
        value={period}
        onChange={setPeriod}
        options={[
          { value: '30', label: '30 days' },
          { value: '90', label: '90 days' },
          { value: '365', label: '12 months' },
        ]}
      />
      <label className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
        Online payments
        <Switch checked={on} onCheckedChange={setOn} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox defaultChecked /> Push notifications
      </label>
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Incoming</TabsTrigger>
          <TabsTrigger value="b">Outgoing</TabsTrigger>
        </TabsList>
        <TabsContent value="a" className="mt-3 text-sm text-fg-muted">
          Incoming requests
        </TabsContent>
        <TabsContent value="b" className="mt-3 text-sm text-fg-muted">
          Outgoing requests
        </TabsContent>
      </Tabs>
    </div>
  );
}

const meta = { title: 'Design system/Forms', component: FormsShowcase } satisfies Meta<typeof FormsShowcase>;
export default meta;
export const Controls: StoryObj<typeof meta> = {};
