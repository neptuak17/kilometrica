import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dpg/ui';

export const SideBySide = () => (
  <Table aria-label="Two stretches side by side">
    <TableHeader>
      <TableHead isRowHeader>Side by side</TableHead>
      <TableHead>Valencia → El Vendrell</TableHead>
      <TableHead>Alcossebre → Blanes</TableHead>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>Days</TableCell>
        <TableCell>7 · 344 km · 49 km a day</TableCell>
        <TableCell>7 · 356 km · 51 km a day</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Climbing</TableCell>
        <TableCell>↑ 285 m a day</TableCell>
        <TableCell>↑ 374 m a day</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Busy roads</TableCell>
        <TableCell>1%</TableCell>
        <TableCell>4%</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Trains</TableCell>
        <TableCell>València · el Vendrell</TableCell>
        <TableCell>Alcalà de Xivert · Blanes</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);
