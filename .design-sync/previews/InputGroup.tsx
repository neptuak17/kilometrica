import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from '@dpg/ui';
import { Search } from 'lucide-react';

export const SearchField = () => (
  <InputGroup className="max-w-sm">
    <InputGroupAddon>
      <Search />
    </InputGroupAddon>
    <InputGroupInput aria-label="Find a town" placeholder="Find a town on the route" />
  </InputGroup>
);

export const WithUnit = () => (
  <InputGroup className="max-w-48">
    <InputGroupInput aria-label="Distance per day" defaultValue="65" />
    <InputGroupAddon align="inline-end">
      <InputGroupText>km a day</InputGroupText>
    </InputGroupAddon>
  </InputGroup>
);

export const WithButton = () => (
  <InputGroup className="max-w-sm">
    <InputGroupInput aria-label="Share link" defaultValue="kilometrica.com/plan#p=8f3k" />
    <InputGroupAddon align="inline-end">
      <InputGroupButton>Copy</InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
);
