import { render } from "@react-email/render";
import type { ReactElement } from "react";

export async function renderEmailTemplate(element: ReactElement) {
  return render(element);
}
