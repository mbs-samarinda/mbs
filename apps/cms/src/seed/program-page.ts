/**
 * The blocks each school's `/program` page starts with.
 *
 * The page map gives this route one job — the academic offering: kurikulum,
 * jenjang, keunggulan, and SMK's jurusan. The first three are a sorotan row,
 * the offering below it is a list. Each is its own block so an editor can
 * reorder or drop one.
 *
 * The umbrella has no entry here. It teaches no classes, its navigation carries
 * no Program item, and the canvas draws it no such page — so the route answers
 * 404 at the apex rather than rendering an empty one.
 *
 * Only the jenjang line states a fact, and it is the same one `/profil` already
 * seeds. Everything else is fill-me copy: a real offering is a claim about a
 * school, and these rows ship to a production database.
 */

import type { Modules } from "@strapi/strapi";

import type { OwnerKey } from "./home-page";

type Block = NonNullable<Modules.Documents.Params.Data.Input<"api::page.page">["blocks"]>[number];

export type ProgramSeed = { title: string; blocks: Block[] };

const highlights = (jenjang: string): Block => ({
  __component: "blocks.highlights",
  items: [
    { label: "Kurikulum", value: "Isi dengan kurikulum yang dipakai sekolah." },
    { label: "Jenjang", value: jenjang },
    { label: "Keunggulan", value: "Isi dengan yang membedakan program di sekolah ini." },
  ],
});

/**
 * SMK composes its offering as jurusan, which carry a code and a kompetensi
 * list; SMP and SMA use the plain program block the homepage already has. Both
 * are placeholders — naming a jurusan a school does not run is the same lie as
 * an invented achievement, and this seed reaches production.
 */
const MAJORS: Block = {
  __component: "blocks.majors",
  head: {
    heading: "Kompetensi keahlian",
    description: "Ganti tiap baris dengan jurusan yang benar-benar dibuka.",
  },
  items: [1, 2, 3].map((n) => ({
    code: "KODE",
    title: `Jurusan ${n}`,
    meta: "3 tahun · berasrama",
    description: "Keterangan singkat jurusan.",
    points: "Kompetensi pertama\nKompetensi kedua\nKompetensi ketiga",
  })),
};

const PROGRAMS: Block = {
  __component: "blocks.programs",
  head: {
    heading: "Program pembelajaran",
    description: "Ganti tiap kartu dengan program yang berjalan.",
  },
  items: [1, 2, 3].map((n) => ({
    title: `Program ${n}`,
    description: "Keterangan singkat program.",
  })),
};

const schoolProgram = (name: string, jenjang: string, offering: Block): ProgramSeed => ({
  title: `Program ${name}`,
  blocks: [highlights(jenjang), offering],
});

export const PROGRAM_SEED: Partial<Record<OwnerKey, ProgramSeed>> = {
  smp: schoolProgram("SMP Islam Terpadu Madina", "Kelas VII–IX, tiga tahun, berasrama", PROGRAMS),
  smk: schoolProgram("SMK Terpadu Madina", "Kelas X–XII, tiga tahun, berasrama", MAJORS),
  sma: schoolProgram("SMA Madina Citra Insani", "Kelas X–XII, tiga tahun, berasrama", PROGRAMS),
};
