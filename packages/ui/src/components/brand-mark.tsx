import logo from "../assets/madina.webp";

/**
 * The umbrella's mark for the admission apps. The artwork has dark lettering and
 * may not be redrawn, so it keeps its own white ground on a dark page.
 */
function BrandMark({ sub }: { sub: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <img src={logo} alt="" width={44} height={44} className="size-11 shrink-0 rounded-lg" />
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-semibold">Madina Boarding School</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export { BrandMark };
