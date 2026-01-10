import { useState } from "react";

import { Button, Card, CardBody, PageHeader } from "../../components/ui";
import ExercisesExplorer from "../exercises/ExercisesExplorer";
import GymsView from "../gyms/GymsView";

export default function LibraryView({
  onLaunchCoach,
  onAddExerciseToWorkout,
  exerciseSeedState,
  onReseedExercises,
}) {
  const [section, setSection] = useState("home");

  if (section === "exercises") {
    return (
      <ExercisesExplorer
        onBack={() => setSection("home")}
        onLaunchCoach={onLaunchCoach}
        onAddToWorkout={onAddExerciseToWorkout}
        isSeeding={exerciseSeedState?.status === "loading"}
        onReseed={onReseedExercises}
      />
    );
  }

  if (section === "gyms") {
    return (
      <GymsView onBack={() => setSection("home")} onLaunchCoach={onLaunchCoach} />
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Library"
        subtitle="Browse exercises, gyms, and training resources."
      />

      <div className="library-grid">
        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Exercises</div>
            <div className="template-meta">
              Explore the Strong-style exercise library and detailed guidance.
            </div>
            <Button variant="primary" size="sm" onClick={() => setSection("exercises")}>
              Open exercises
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Gyms</div>
            <div className="template-meta">
              Manage workout spaces, equipment, and template compatibility.
            </div>
            <Button variant="primary" size="sm" onClick={() => setSection("gyms")}>
              Open gyms
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Analytics</div>
            <div className="template-meta">Coming soon: training insights and trends.</div>
            <Button variant="secondary" size="sm" disabled>
              Coming soon
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="ui-stack">
            <div className="ui-strong">Settings</div>
            <div className="template-meta">Adjust preferences and coach controls.</div>
            <Button variant="secondary" size="sm" disabled>
              Use tab bar
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
