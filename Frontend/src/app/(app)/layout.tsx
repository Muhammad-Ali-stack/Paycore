import { AppShell } from '@/components/layout/app-shell';

export default function ConsumerLayout({ children }: { children: React.ReactNode }) {
  return <AppShell portal="consumer">{children}</AppShell>;
}
