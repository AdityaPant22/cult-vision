import { User } from "../../../types";

type ExistingUserResolution = {
  type: "existing-user";
  user: User;
};

type GeneratedUserResolution = {
  type: "generated-user";
  name: string;
};

export type PhoneAuthResolution = ExistingUserResolution | GeneratedUserResolution;

const FALLBACK_NAMES = [
  "Rohan",
  "Ananya",
  "Vikram",
  "Priya",
  "Kunal",
  "Ira",
  "Siddharth",
  "Tara"
];

function sumDigits(value: string): number {
  return value.split("").reduce((sum, digit) => sum + Number.parseInt(digit, 10), 0);
}

export function resolvePrototypePhoneAuth(params: {
  phone: string;
  knownUsers: User[];
  connectedUserIds: Set<string>;
}): PhoneAuthResolution {
  const availableUsers = params.knownUsers.filter(
    (user) => !params.connectedUserIds.has(user.id)
  );
  const numericValue = sumDigits(params.phone);

  if (availableUsers.length > 0) {
    return {
      type: "existing-user",
      user: availableUsers[numericValue % availableUsers.length]
    };
  }

  return {
    type: "generated-user",
    name: FALLBACK_NAMES[numericValue % FALLBACK_NAMES.length]
  };
}
