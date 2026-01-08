export default function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="ui-page-header">
      <div>
        <div className="ui-page-title">{title}</div>
        {subtitle ? <div className="ui-page-subtitle">{subtitle}</div> : null}
        {children}
      </div>
      {actions ? <div className="ui-page-actions">{actions}</div> : null}
    </div>
  );
}
