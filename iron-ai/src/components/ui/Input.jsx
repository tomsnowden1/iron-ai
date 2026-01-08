import { forwardRef } from "react";

const Input = forwardRef(function Input({ className = "", ...props }, ref) {
  return <input ref={ref} className={`ui-input ${className}`.trim()} {...props} />;
});

export default Input;
