import Link from "next/link";

import { ARKADEMY_COLUMN, ARKADEMY_TITLE } from "@/components/arkademy/ArkademyChrome";
import { ARKADEMY_PATH } from "@/lib/arkademy/tools";
import { cn } from "@/lib/utils";

/**
 * What `notFound()` renders under /arkademy (an unknown example's tour, from
 * part 3), inside the Arkademy's chrome: app/arkademy/layout.tsx wraps it.
 */
export default function ArkademyNotFound() {
  return (
    <div className={cn(ARKADEMY_COLUMN, "pt-10 pb-24")}>
      <h1 className={ARKADEMY_TITLE}>Not in the library</h1>
      <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
        Nothing in the Arkademy answers to this address. The example may have been renamed or removed.
      </p>
      <Link href={ARKADEMY_PATH} className="mt-6 inline-block text-sm underline underline-offset-4 hover:text-foreground">
        Back to the Arkademy
      </Link>
    </div>
  );
}
