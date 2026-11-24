import { UnreachableError } from "@mbs/api-client/http";
import { ORPCError } from "@mbs/api-client/rpc";
import type { CommitteeApplication, HistoryItem } from "@mbs/api-contract";
import { formatDate } from "@mbs/school-config/format";
import { Alert } from "@mbs/ui/components/alert";
import { Button, buttonVariants } from "@mbs/ui/components/button";
import { Textarea } from "@mbs/ui/components/textarea";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  EyeIcon,
  LockIcon,
  MessageCircleIcon,
  PhoneIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  actorName,
  chipClass,
  EXACT_MATCH,
  eventEntry,
  SchoolMark,
  Stage,
  Tile,
  Timeline,
  type AuditItem,
  type Entry,
} from "../committee-ui.tsx";
import { api, applicationQuery, dashboardQuery } from "../staff.ts";

type RecordSearch = { tampil?: "catatan" | undefined };

export const Route = createFileRoute("/_app/pendaftar/$applicationId")({
  validateSearch: ({ tampil }: Record<string, unknown>): RecordSearch => ({
    tampil: tampil === "catatan" ? "catatan" : undefined,
  }),
  loader: async ({ context: { queryClient }, params }) => {
    try {
      await queryClient.ensureQueryData(applicationQuery(params.applicationId));
    } catch (error) {
      // Another school's, not there, and not an id at all are the same answer.
      if (error instanceof ORPCError && ["NOT_FOUND", "BAD_REQUEST"].includes(error.code)) {
        throw notFound();
      }
      throw error;
    }
  },
  head: () => ({ meta: [{ title: "Pendaftar · Panitia PPDB" }] }),
  component: RecordPage,
  notFoundComponent: Missing,
});

const NOTE_MAX = 2000;

function RecordPage() {
  const { applicationId } = Route.useParams();
  const { tampil } = Route.useSearch();
  const { data: application } = useSuspenseQuery(applicationQuery(applicationId));
  useRecordView(applicationId);

  const { profile } = application;
  const history =
    tampil === "catatan"
      ? application.history.filter((item) => item.kind === "EVENT" && item.command === "ADD_NOTE")
      : application.history;
  const phoneDigits = profile.guardianPhone.replace(/\D/g, "");
  return (
    <div className="grid content-start">
      <div className="grid gap-5 border-b border-border p-[min(2rem,5vw)] pb-6">
        <Link
          to="/pendaftar"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden className="size-4 shrink-0" /> Pendaftar
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <Tile name={profile.childFullName} school={application.schoolKey} size="lg" />
            <div className="grid min-w-0 gap-1">
              <h1 tabIndex={-1} className="text-2xl font-semibold wrap-anywhere outline-none">
                {profile.childFullName}
              </h1>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <SchoolMark school={application.schoolKey} />
                <span className="tabular-nums">{application.registrationNumber}</span>
                <Stage stage={application.stage} needsCommittee={application.needsCommittee} />
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/${phoneDigits}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              <MessageCircleIcon aria-hidden /> WhatsApp wali
            </a>
            <a
              href={`tel:${profile.guardianPhone}`}
              className={buttonVariants({ variant: "outline" })}
            >
              <PhoneIcon aria-hidden /> Telepon
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Riwayat" className="grid content-start gap-5 p-[min(2rem,5vw)]">
          {application.canAddNote && <Composer application={application} />}
          <nav aria-label="Saring riwayat" className="flex flex-wrap gap-1">
            <Link
              to="/pendaftar/$applicationId"
              params={{ applicationId }}
              search={{}}
              replace
              activeOptions={EXACT_MATCH}
              className={chipClass(tampil === undefined)}
            >
              Semua
            </Link>
            <Link
              to="/pendaftar/$applicationId"
              params={{ applicationId }}
              search={{ tampil: "catatan" }}
              replace
              activeOptions={EXACT_MATCH}
              className={chipClass(tampil === "catatan")}
            >
              Catatan
            </Link>
          </nav>
          {history.length > 0 ? (
            <Timeline entries={feed(history)} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {tampil === "catatan" ? "Belum ada catatan." : "Belum ada aktivitas."}
            </p>
          )}
        </section>
        <aside className="grid content-start gap-7 border-border p-[min(2rem,5vw)] max-xl:border-t xl:border-l">
          <Panel title="Wali">
            <Prop
              term="Nama"
              value={`${profile.guardianName} (${RELATIONS[profile.guardianRelation]})`}
            />
            <Prop term="Telepon" value={profile.guardianPhone} />
            <Prop term="Email" value={application.accountEmail} />
          </Panel>
          <Panel title="Data anak">
            <Prop term="NIK" value={profile.nik} />
            <Prop term="Lahir" value={formatDate(profile.birthDate)} />
            <Prop term="Jenis kelamin" value={SEXES[profile.sex]} />
            <Prop term="Sekolah asal" value={profile.schoolOfOrigin} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

const RELATIONS = { FATHER: "Ayah", MOTHER: "Ibu", GUARDIAN: "Wali" } as const;
const SEXES = { MALE: "Laki-laki", FEMALE: "Perempuan" } as const;

/**
 * Once per visit, never in the loader: the router preloads this page on hover and
 * the query refetches on focus, and neither is someone reading it. The ref
 * survives StrictMode's second run of the effect, and a new visit gets a new one.
 */
function useRecordView(applicationId: string) {
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (recorded.current === applicationId) return;
    recorded.current = applicationId;
    // A view that fails to record must not stop anyone reading the page.
    api.staff.applications.recordView({ applicationId }).catch(() => {});
  }, [applicationId]);
}

/** Views in a row fold into one quiet line, so reading a page many times does not bury its history. */
function feed(history: HistoryItem[]): Entry[] {
  const entries: Entry[] = [];
  let views: AuditItem[] = [];
  const flush = () => {
    if (views.length === 0) return;
    const names = [...new Set(views.map((view) => actorName(view.actor)))];
    entries.push({
      key: `views-${views[0]!.at}`,
      icon: EyeIcon,
      tone: "plain",
      who: null,
      title:
        names.length <= 2
          ? `Dibuka oleh ${names.join(" dan ")}`
          : `Dibuka oleh ${names.length} staf`,
      body: null,
      at: views[0]!.at,
      ...(names.length > 2 && { more: names }),
    });
    views = [];
  };
  for (const item of history) {
    if (item.kind === "AUDIT" && item.action === "application.viewed") {
      views.push(item);
      continue;
    }
    flush();
    entries.push(
      item.kind === "EVENT"
        ? eventEntry(`event-${item.seq}`, item)
        : {
            key: `check-${item.at}`,
            icon: SearchIcon,
            tone: "plain",
            who: actorName(item.actor),
            title: "Mengecek status",
            body: null,
            at: item.at,
          },
    );
  }
  flush();
  return entries;
}

function Composer({ application }: { application: CommitteeApplication }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  // One key per note, kept while the same text is retried, so a retry never saves it twice.
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const save = useMutation({
    mutationFn: (text: string) => {
      if (attempt.current?.text !== text) attempt.current = { text, key: crypto.randomUUID() };
      return api.staff.applications.addNote({
        applicationId: application.id,
        note: text,
        idempotencyKey: attempt.current.key,
      });
    },
    onSuccess: async () => {
      attempt.current = null;
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries(applicationQuery(application.id)),
        queryClient.invalidateQueries(dashboardQuery),
        queryClient.invalidateQueries({ queryKey: ["applications", "list"] }),
      ]);
    },
  });
  const text = note.trim();

  return (
    <form
      className="grid gap-2 rounded-md border border-border p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
      onSubmit={(event) => {
        event.preventDefault();
        if (text && !save.isPending) save.mutate(text);
      }}
    >
      <Textarea
        aria-label="Catatan untuk panitia"
        placeholder="Tulis catatan untuk panitia…"
        maxLength={NOTE_MAX}
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="min-h-12 resize-none border-0 bg-transparent p-0 outline-none focus-visible:outline-none dark:bg-transparent"
      />
      {save.error && (
        <Alert>
          {save.error instanceof UnreachableError
            ? "Server tidak bisa dihubungi. Catatan kamu masih di sini, coba simpan lagi."
            : "Catatan belum tersimpan. Coba simpan lagi."}
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <LockIcon aria-hidden className="size-3 shrink-0" /> Keluarga tidak melihat catatan
        </span>
        <span className="flex items-center gap-3">
          {note.length > NOTE_MAX - 200 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {note.length} dari {NOTE_MAX}
            </span>
          )}
          <Button type="submit" size="sm" disabled={!text || save.isPending} focusableWhenDisabled>
            {save.isPending ? "Menyimpan…" : "Simpan"}
          </Button>
        </span>
      </div>
    </form>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="grid gap-2">{children}</dl>
    </section>
  );
}

function Prop({ term, value }: { term: string; value: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="wrap-anywhere tabular-nums">
        {value || <span className="text-muted-foreground">Belum diisi</span>}
      </dd>
    </div>
  );
}

function Missing() {
  return (
    <div className="grid content-start gap-3 p-[min(2rem,5vw)]">
      <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">
        Pendaftar tidak ditemukan
      </h1>
      <p className="max-w-[60ch] text-sm text-pretty text-muted-foreground">
        Pendaftaran ini tidak ada, atau bukan di sekolah kamu. Periksa lagi alamatnya.
      </p>
      <Link to="/pendaftar" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>
        Buka daftar pendaftar
      </Link>
    </div>
  );
}
