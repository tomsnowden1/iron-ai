export function Card({ className = "", ...props }) {
  return <div className={`ui-card ${className}`.trim()} {...props} />;
}

export function CardHeader({ className = "", ...props }) {
  return <div className={`ui-card__header ${className}`.trim()} {...props} />;
}

export function CardBody({ className = "", ...props }) {
  return <div className={`ui-card__body ${className}`.trim()} {...props} />;
}

export function CardFooter({ className = "", ...props }) {
  return <div className={`ui-card__footer ${className}`.trim()} {...props} />;
}
