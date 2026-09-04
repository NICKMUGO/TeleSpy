interface PageHeaderProps {
  title: string;
  description?: string;
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="border-border border-b px-6 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {description}
        </p>
      ) : null}
    </div>
  );
}
