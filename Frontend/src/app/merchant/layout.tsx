import { AppShell } from '@/components/layout/app-shell';

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <AppShell portal="merchant">{children}</AppShell>;
}
