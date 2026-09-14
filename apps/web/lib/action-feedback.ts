import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function runWithActionFeedback(
  returnPath: string,
  revalidatePaths: readonly string[],
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    redirect(`${returnPath}?notice=blocked`);
    throw error;
  }
  for (const path of revalidatePaths) revalidatePath(path);
  redirect(`${returnPath}?notice=success`);
}

export function actionNotice(value: string | string[] | undefined): string | undefined {
  if (value === 'success') return 'Change saved successfully.';
  if (value === 'blocked') return 'That change could not be completed. Review the requirements and try again.';
  return undefined;
}
