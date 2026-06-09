import type { ReactElement } from "react";
import { render } from "react-email";

/**
 * Renders a React Email component to an HTML string.
 */
export async function renderEmailTemplate(
  component: ReactElement
): Promise<string> {
  return render(component);
}
