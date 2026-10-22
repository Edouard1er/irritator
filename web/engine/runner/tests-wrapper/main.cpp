#include "fixtures.hpp"
#include <iostream>
#include <cstdlib>
#if defined(_MSC_VER) && defined(_DEBUG)
#include <crtdbg.h>
#endif
namespace wrapper_test { void run_case(const std::string&); }

int main(int argc, char** argv)
{
#ifdef _MSC_VER
    (void)_set_error_mode(_OUT_TO_STDERR);
    _set_abort_behavior(0, _WRITE_ABORT_MSG | _CALL_REPORTFAULT);
#ifdef _DEBUG
    _CrtSetReportMode(_CRT_ASSERT, _CRTDBG_MODE_FILE);
    _CrtSetReportFile(_CRT_ASSERT, _CRTDBG_FILE_STDERR);
#endif
#endif
    std::cout << std::unitbuf;
    try {
        irt_web::require(argc == 2, "Usage: runner-wrapper-tests CASE");
        const std::string name = argv[1];
        wrapper_test::run_case(name);
        std::cout << "PASS " << name << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << '\n';
        return 1;
    }
}
