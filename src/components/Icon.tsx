export default function Icon({ name }: { name: string }) {
  return <span aria-hidden="true" className={`codicon codicon-${name}`} />;
}
