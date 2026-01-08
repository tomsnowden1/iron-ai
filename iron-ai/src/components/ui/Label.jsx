export default function Label({ className = "", ...props }) {
  return <label className={`ui-label ${className}`.trim()} {...props} />;
}
