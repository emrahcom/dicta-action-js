# Room for the saved request

When the saved request does not fit in session storage, the oldest requests in
the history go first until it fits, as `architecture.md` (Storage) describes.

- Saving tries again after each dropped history request; with no history left,
  it gives up as now.
- Unit test: with a storage that is full until history requests are dropped, the
  saved request is written and the newest history requests stay.
