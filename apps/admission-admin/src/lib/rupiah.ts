/** Grouped rupiah for display: `250000` reads as `250.000`. */
export function formatRupiah(digits: string) {
  const clean = digits.replace(/\D/g, "");
  // BigInt rather than Number: exact at any length, and it drops leading zeros
  // on the way through.
  return clean === "" ? "" : new Intl.NumberFormat("id-ID").format(BigInt(clean));
}

/**
 * Reformats what was typed and works out where the caret belongs afterwards.
 *
 * Regrouping moves every separator, so a controlled input that only reformats
 * would drop the caret at the end after each keystroke — fine when appending,
 * wrong the moment someone corrects a digit in the middle. The caret is mapped
 * across by counting digits rather than characters, which is the one thing
 * both strings agree on.
 */
export function reformatRupiah(raw: string, caretIndex: number) {
  const digits = raw.replace(/\D/g, "");
  const formatted = formatRupiah(digits);
  const digitsBeforeCaret = raw.slice(0, caretIndex).replace(/\D/g, "").length;

  if (digitsBeforeCaret === 0) return { digits, formatted, caret: 0 };

  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    const character = formatted[index]!;
    if (character >= "0" && character <= "9") {
      seen += 1;
      if (seen === digitsBeforeCaret) return { digits, formatted, caret: index + 1 };
    }
  }

  return { digits, formatted, caret: formatted.length };
}
