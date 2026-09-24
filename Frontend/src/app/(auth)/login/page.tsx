import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from './login-form';

export async function generateMetadata() {
  const t = await getTranslations('auth');
  return { title: t('signIn') };
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm mocking={process.env.NEXT_PUBLIC_API_MOCKING === 'enabled'} />
    </Suspense>
  );
}
