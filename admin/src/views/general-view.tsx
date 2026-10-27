import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldsForm } from '@/components/fields';
import { GENERAL_FIELDS } from '@/lib/shared';
import { useStore } from '@/lib/store';

export function GeneralView() {
  const { cfg, t, touch } = useStore();
  return (
    <Card className="mx-auto w-full max-w-4xl">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{t('General')}</CardTitle>
        <CardDescription>{t('Location, time zone, design and behaviour of the mirror.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldsForm fields={GENERAL_FIELDS} values={cfg.general} onChange={touch} />
      </CardContent>
    </Card>
  );
}
