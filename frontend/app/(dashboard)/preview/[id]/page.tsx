type PreviewPageProps = {
  params: {
    id: string;
  };
};

export default function PreviewPage({ params }: PreviewPageProps) {
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">预览</p>
      <h1 className="text-2xl font-semibold tracking-normal">预览 {params.id}</h1>
      <div className="rounded-lg border bg-card p-6 text-card-foreground">
        <p className="text-sm text-muted-foreground">预览内容占位。</p>
      </div>
    </section>
  );
}
