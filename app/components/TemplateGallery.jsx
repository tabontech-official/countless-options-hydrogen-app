import { Form, useNavigation } from "react-router";

// Template cards with a photo cover. Choosing one saves a copy of the template as an option
// set in this store (the action in app.templates.jsx), then opens it, so nothing is lost on
// discard or reload.
export function TemplateGallery({ templates }) {
  const navigation = useNavigation();
  const adding = navigation.state !== "idle" && navigation.formData?.get("template");

  return (
    <div className="co-templates">
      {templates.map((t) => (
        <Form key={t.id} method="post" action="/app/templates" className="co-template-form">
          <input type="hidden" name="template" value={t.id} />
          <button
            type="submit"
            className="co-template"
            disabled={Boolean(adding)}
            aria-busy={adding === t.id}
            aria-label={`Use the ${t.name} template`}
          >
            <span className="co-template__cover" style={{ background: t.tint }}>
              <img src={`/templates/${t.id}.jpg`} alt="" width="640" height="400" loading="lazy" decoding="async" />
              <span className="co-template__cta">{adding === t.id ? "Adding…" : "Use template"}</span>
            </span>
            <span className="co-template__name">{t.name}</span>
            <span className="co-template__desc">{t.description}</span>
          </button>
        </Form>
      ))}
    </div>
  );
}
