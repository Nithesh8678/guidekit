# GuideKit dashboard design

The dashboard connects a company's knowledge to a published, embedded guide. The central motif is a readable connection from draft to published version, with a deliberate single-agent editor rather than an unrelated grid of metrics.

Palette: navigation navy `#111c35`, ink `#182542`, cobalt `#365cf5`, mist `#edf3ff`, border `#dce3ed`, canvas `#f7f9fc`. System sans typography keeps the local developer tool self-contained, with a compact 14px body and tightly tracked 30px page titles. Code uses system monospace only where users copy code.

Layout: a dark workspace sidebar contains actual agent selection; the white editor has a title, publish control, and four task tabs. Configuration and its greeting preview occupy an asymmetric two-column layout. Knowledge, installation, and activity have their own purposeful structures. All content is left aligned.

The brief explicitly calls for navy and cobalt, so these are followed. The usual KPI-card grid has been removed in favor of a continuous editor, a version bar, and a clear next action. Publishing and document changes have distinct loading and error states. Browser permissions and provider support are stated at the point of use.
