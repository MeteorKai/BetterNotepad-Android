const paths = {
  note: "M7 3h8l4 4v14H5V3h2 M14 3v5h5 M9 12h6 M9 16h5",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  sort: "M4 6h16 M4 12h16 M4 18h16",
  tag: "M3 3h8l10 10-8 8L3 11V3 M7 7h.01",
  checklist: "M9 6h12 M9 12h12 M9 18h12 M3 5l1 1 2-2 M3 11l1 1 2-2 M3 17l1 1 2-2",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  settings: "M4 6h4 M12 6h8 M4 12h10 M18 12h2 M4 18h2 M10 18h10 M8 3v6 M14 9v6 M6 15v6",
  back: "M19 12H5 M12 5l-7 7 7 7",
  pin: "M8 3h8 M9 3v6l-3 4v2h12v-2l-3-4V3 M12 15v6",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  check: "M5 12l4 4L19 6",
  sun: "M12 3V1 M12 23v-2 M3 12H1 M23 12h-2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  moon: "M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z",
  palette: "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 1.5 1.5 0 0 1 1.2-2.4H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9 M7 10h.01 M10 7h.01 M15 7h.01 M17 11h.01",
  close: "M6 6l12 12 M18 6L6 18",
  arrow: "M5 12h14 M13 6l6 6-6 6",
};

export default function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
